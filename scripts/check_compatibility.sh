#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to run this script." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to run this script." >&2
  exit 1
fi

if [ ! -f package.json ]; then
  echo "Error: package.json not found in $(pwd)." >&2
  exit 1
fi

node - <<'NODE'
const fs = require('fs');
const { execSync } = require('child_process');
let semver;
try {
  semver = require('semver');
} catch (err) {
  try {
    semver = require('./scripts/lib/semver_fallback.js');
    console.warn('Warning: Falling back to bundled semver implementation. Results may be approximate.');
  } catch (fallbackError) {
    console.error('Error: Unable to load a semver implementation. Install "semver" with "npm install semver".');
    process.exit(1);
  }
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const rootName = pkg.name || '(unnamed package)';
const rootVersion = pkg.version || '0.0.0';

const toObject = (value) => value && typeof value === 'object' ? value : {};

const rootDeps = {
  dependencies: toObject(pkg.dependencies),
  devDependencies: toObject(pkg.devDependencies),
  peerDependencies: toObject(pkg.peerDependencies)
};

const queue = [];
const seen = new Set();
const declared = new Map();
const latestVersions = new Map();
const upgrades = new Map();

const includePrerelease = true;

const addDeclaration = (name, range, meta) => {
  if (!range || typeof range !== 'string') return;
  const list = declared.get(name) || [];
  list.push(meta);
  declared.set(name, list);
};

const enqueueDeps = (type, deps, via, path) => {
  for (const [name, range] of Object.entries(deps)) {
    addDeclaration(name, range, { range, via, type, root: path === rootName, path });
    queue.push({ name, range, via, type, path: `${path} > ${name}` });
  }
};

enqueueDeps('dependency', rootDeps.dependencies, rootName, rootName);
enqueueDeps('devDependency', rootDeps.devDependencies, rootName, rootName);
enqueueDeps('peerDependency', rootDeps.peerDependencies, rootName, rootName);

const registryCache = new Map();

const fetchPackage = (name) => {
  if (registryCache.has(name)) {
    return registryCache.get(name);
  }
  const url = `https://registry.npmjs.com/${encodeURIComponent(name)}`;
  let output;
  try {
    output = execSync(`curl -sSfL ${JSON.stringify(url)}`, { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`Failed to fetch ${name} from npm registry: ${error.message}`);
  }
  const data = JSON.parse(output);
  registryCache.set(name, data);
  return data;
};

const ensureUpgradeEntry = (packageName) => {
  if (!upgrades.has(packageName)) {
    const rootDecls = (declared.get(packageName) || []).filter((entry) => entry.root);
    upgrades.set(packageName, {
      name: packageName,
      currentRanges: rootDecls.length ? [...new Set(rootDecls.map((entry) => entry.range))] : ['(not declared)'],
      reasons: [],
      recommendedVersions: new Set()
    });
  }
  return upgrades.get(packageName);
};

const registerRecommendedVersion = (entry, version) => {
  if (!version) return;
  try {
    const parsed = semver.coerce(version);
    if (!parsed) return;
    entry.recommendedVersions.add(parsed.version);
  } catch (err) {
    // ignore unparsable versions
  }
};

while (queue.length) {
  const item = queue.shift();
  const key = `${item.name}|||${item.range}`;
  if (seen.has(key)) continue;
  seen.add(key);

  let data;
  try {
    data = fetchPackage(item.name);
  } catch (err) {
    const entry = ensureUpgradeEntry(item.name);
    entry.reasons.push(`Unable to fetch metadata for ${item.name}: ${err.message}`);
    continue;
  }

  const latestTag = data['dist-tags'] && data['dist-tags'].latest;
  if (!latestTag || !data.versions || !data.versions[latestTag]) {
    continue;
  }

  const latestMeta = data.versions[latestTag];
  latestVersions.set(item.name, latestTag);

  const rootDecls = (declared.get(item.name) || []).filter((entry) => entry.root);
  if (rootDecls.length) {
    const satisfiesLatest = rootDecls.some((entry) => {
      try {
        return semver.satisfies(latestTag, entry.range, { includePrerelease });
      } catch (err) {
        return false;
      }
    });
    if (!satisfiesLatest) {
      const entry = ensureUpgradeEntry(item.name);
      entry.reasons.push(`Latest version ${latestTag} is outside declared range${entry.currentRanges.length > 1 ? 's' : ''}.`);
      registerRecommendedVersion(entry, latestTag);
    }
  }

  const dependencies = toObject(latestMeta.dependencies);
  if (Object.keys(dependencies).length) {
    enqueueDeps('dependency', dependencies, `${item.name}@${latestTag}`, `${item.path}`);
  }

  const peerDeps = toObject(latestMeta.peerDependencies);
  for (const [peerName, peerRange] of Object.entries(peerDeps)) {
    const declaredEntries = declared.get(peerName) || [];
    const matches = declaredEntries.some((entry) => {
      try {
        return semver.intersects(entry.range, peerRange, { includePrerelease });
      } catch (err) {
        return false;
      }
    });

    if (!matches) {
      const entry = ensureUpgradeEntry(peerName);
      entry.reasons.push(`${item.name}@${latestTag} requires ${peerName} ${peerRange} (peer dependency).`);
      const min = semver.minVersion(peerRange);
      if (min) {
        registerRecommendedVersion(entry, min.version);
      }
    }
  }
}

const reportLines = [];
reportLines.push(`Compatibility report for ${rootName}@${rootVersion}`);
reportLines.push('');

if (!upgrades.size) {
  reportLines.push('All dependencies appear compatible with the latest releases.');
} else {
  const sorted = [...upgrades.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    reportLines.push(`- ${entry.name}`);
    reportLines.push(`  Current range: ${entry.currentRanges.join(', ')}`);
    const latest = latestVersions.get(entry.name);
    if (latest) {
      reportLines.push(`  Latest version: ${latest}`);
    }
    reportLines.push('  Issues:');
    entry.reasons.forEach((reason) => {
      reportLines.push(`    • ${reason}`);
    });
    if (entry.recommendedVersions.size) {
      const recommended = [...entry.recommendedVersions].sort(semver.compare);
      reportLines.push(`  Recommended minimum version: ${recommended[recommended.length - 1]}`);
    }
    reportLines.push('');
  }
}

console.log(reportLines.join('\n'));
NODE
