'use strict';

const WILDCARD_VALUES = new Set(['x', 'X', '*', '']);

function cloneVersion(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
    prerelease: version.prerelease ? [...version.prerelease] : [],
    version: formatVersion(version)
  };
}

function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease && version.prerelease.length) {
    return `${base}-${version.prerelease.join('.')}`;
  }
  return base;
}

function parseVersionString(input) {
  if (input == null) return null;
  if (typeof input !== 'string') input = String(input);
  const cleaned = input.trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^[v=\s]*([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const patch = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  const prerelease = match[4] ? match[4].split('.') : [];
  if ([major, minor, patch].some((value) => Number.isNaN(value) || value < 0)) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease,
    version: formatVersion({ major, minor, patch, prerelease })
  };
}

function parseVersionWithWildcards(input) {
  if (input == null) return null;
  if (typeof input !== 'string') input = String(input);
  const cleaned = input.trim();
  if (!cleaned) return { wildcard: true };
  const match = cleaned.match(/^[v=\s]*([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  const parts = [match[1], match[2], match[3]];
  const values = parts.map((part) => {
    if (part === undefined) return null;
    return WILDCARD_VALUES.has(part) ? null : Number.parseInt(part, 10);
  });
  const prerelease = match[4] ? match[4].split('.') : [];
  const hasWildcard = values.some((value) => value === null);
  return {
    major: values[0],
    minor: values[1],
    patch: values[2],
    prerelease,
    hasWildcard
  };
}

function comparePrerelease(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftIsNum = /^[0-9]+$/.test(left);
    const rightIsNum = /^[0-9]+$/.test(right);
    if (leftIsNum && rightIsNum) {
      const leftNum = Number.parseInt(left, 10);
      const rightNum = Number.parseInt(right, 10);
      if (leftNum !== rightNum) return leftNum - rightNum;
      continue;
    }
    if (leftIsNum) return -1;
    if (rightIsNum) return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function compareVersions(leftInput, rightInput) {
  const left = typeof leftInput === 'string' ? parseVersionString(leftInput) : leftInput;
  const right = typeof rightInput === 'string' ? parseVersionString(rightInput) : rightInput;
  if (!left || !right) return 0;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  const leftHasPrerelease = left.prerelease && left.prerelease.length;
  const rightHasPrerelease = right.prerelease && right.prerelease.length;
  if (!leftHasPrerelease && !rightHasPrerelease) return 0;
  if (!leftHasPrerelease) return 1;
  if (!rightHasPrerelease) return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function isAnyRangeToken(token) {
  return token === '*' || token === '' || token.toLowerCase() === 'x';
}

function normalizeVersion(parsed) {
  const major = parsed.major ?? 0;
  const minor = parsed.minor ?? 0;
  const patch = parsed.patch ?? 0;
  const prerelease = parsed.prerelease ? [...parsed.prerelease] : [];
  return {
    major,
    minor,
    patch,
    prerelease,
    version: formatVersion({ major, minor, patch, prerelease })
  };
}

function incrementPatch(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    prerelease: [],
    version: `${version.major}.${version.minor}.${version.patch + 1}`
  };
}

function incrementMinor(version) {
  return {
    major: version.major,
    minor: version.minor + 1,
    patch: 0,
    prerelease: [],
    version: `${version.major}.${version.minor + 1}.0`
  };
}

function incrementMajor(version) {
  return {
    major: version.major + 1,
    minor: 0,
    patch: 0,
    prerelease: [],
    version: `${version.major + 1}.0.0`
  };
}

function caretUpperBound(parsed) {
  const base = normalizeVersion(parsed);
  if (base.major > 0) {
    return incrementMajor(base);
  }
  if (base.minor > 0) {
    return {
      major: 0,
      minor: base.minor + 1,
      patch: 0,
      prerelease: [],
      version: `0.${base.minor + 1}.0`
    };
  }
  return {
    major: 0,
    minor: 0,
    patch: base.patch + 1,
    prerelease: [],
    version: `0.0.${base.patch + 1}`
  };
}

function tildeUpperBound(parsed) {
  const base = normalizeVersion(parsed);
  if (parsed.minor != null) {
    return {
      major: base.major,
      minor: base.minor + 1,
      patch: 0,
      prerelease: [],
      version: `${base.major}.${base.minor + 1}.0`
    };
  }
  return incrementMajor(base);
}

function wildcardUpperBound(parsed) {
  if (parsed.major == null) return null;
  const base = normalizeVersion(parsed);
  if (parsed.minor == null) {
    return incrementMajor(base);
  }
  if (parsed.patch == null) {
    return incrementMinor(base);
  }
  return incrementPatch(base);
}

function parseHyphenRange(range) {
  const match = range.match(/^(.*)\s+-\s+(.*)$/);
  if (!match) return null;
  const minToken = match[1].trim();
  const maxToken = match[2].trim();
  const minParsed = parseVersionWithWildcards(minToken);
  const maxParsed = parseVersionWithWildcards(maxToken);
  if (!minParsed || !maxParsed) return null;
  const comparators = [];
  if (!minParsed.hasWildcard) {
    comparators.push({ operator: '>=', version: normalizeVersion(minParsed), inclusive: true });
  } else {
    const lower = normalizeVersion(minParsed);
    comparators.push({ operator: '>=', version: lower, inclusive: true });
  }
  let upper;
  if (maxParsed.hasWildcard) {
    upper = wildcardUpperBound(maxParsed);
    if (upper) {
      comparators.push({ operator: '<', version: upper, inclusive: false });
    }
  } else {
    const normalized = normalizeVersion(maxParsed);
    comparators.push({ operator: '<=', version: normalized, inclusive: true });
  }
  return comparators;
}

function parseComparatorToken(token) {
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (isAnyRangeToken(trimmed)) return [];
  if (trimmed.startsWith('^')) {
    const body = trimmed.slice(1);
    const parsed = parseVersionWithWildcards(body);
    if (!parsed) return [];
    const lower = normalizeVersion(parsed);
    const upper = caretUpperBound(parsed);
    return [
      { operator: '>=', version: lower, inclusive: true },
      { operator: '<', version: upper, inclusive: false }
    ];
  }
  if (trimmed.startsWith('~')) {
    const body = trimmed.slice(1);
    const parsed = parseVersionWithWildcards(body);
    if (!parsed) return [];
    const lower = normalizeVersion(parsed);
    const upper = tildeUpperBound(parsed);
    return [
      { operator: '>=', version: lower, inclusive: true },
      { operator: '<', version: upper, inclusive: false }
    ];
  }
  const match = trimmed.match(/^(<=|>=|<|>|=)?\s*(.*)$/);
  if (!match) return [];
  const operator = match[1] || '=';
  const body = match[2];
  const parsed = parseVersionWithWildcards(body);
  if (!parsed) return [];
  if (parsed.major == null) {
    return [];
  }
  const lower = normalizeVersion(parsed);
  if (operator === '=') {
    if (parsed.hasWildcard || parsed.minor == null || parsed.patch == null) {
      const upper = wildcardUpperBound(parsed);
      if (upper) {
        return [
          { operator: '>=', version: lower, inclusive: true },
          { operator: '<', version: upper, inclusive: false }
        ];
      }
      return [];
    }
    return [
      { operator: '>=', version: lower, inclusive: true },
      { operator: '<=', version: lower, inclusive: true }
    ];
  }
  if (parsed.hasWildcard || parsed.minor == null || parsed.patch == null) {
    const upper = wildcardUpperBound(parsed);
    if ((operator === '<' || operator === '<=') && upper) {
      const inclusive = operator === '<=';
      return [
        { operator: inclusive ? '<=' : '<', version: upper, inclusive }
      ];
    }
    if (operator === '>' || operator === '>=') {
      return [
        { operator: '>=', version: lower, inclusive: operator === '>=' }
      ];
    }
  }
  return [
    { operator, version: lower, inclusive: operator === '>=' || operator === '<=' }
  ];
}

function parseRangePart(part) {
  const trimmed = part.trim();
  if (!trimmed) return [];
  const hyphen = parseHyphenRange(trimmed);
  if (hyphen) return hyphen;
  const tokens = trimmed.split(/\s+/);
  let comparators = [];
  for (const token of tokens) {
    comparators = comparators.concat(parseComparatorToken(token));
  }
  return comparators;
}

function parseRange(range) {
  if (typeof range !== 'string') return null;
  const raw = range.trim();
  if (!raw) return [[]];
  const parts = raw.split('||');
  const sets = [];
  for (const part of parts) {
    const comparators = parseRangePart(part);
    sets.push(comparators);
  }
  return sets.length ? sets : [[]];
}

function satisfiesComparators(version, comparators) {
  for (const comparator of comparators) {
    const cmp = compareVersions(version, comparator.version);
    switch (comparator.operator) {
      case '>':
        if (!(cmp > 0)) return false;
        break;
      case '>=':
        if (!(cmp > 0 || (cmp === 0 && comparator.inclusive))) return false;
        break;
      case '<':
        if (!(cmp < 0)) return false;
        break;
      case '<=':
        if (!(cmp < 0 || (cmp === 0 && comparator.inclusive))) return false;
        break;
      default:
        if (cmp !== 0) return false;
        break;
    }
  }
  return true;
}

function satisfies(version, range) {
  const parsedVersion = typeof version === 'string' ? parseVersionString(version) : version;
  if (!parsedVersion) return false;
  const sets = parseRange(range);
  if (!sets) return false;
  for (const comparators of sets) {
    if (!comparators.length) return true;
    if (satisfiesComparators(parsedVersion, comparators)) return true;
  }
  return false;
}

function combineComparators(...sets) {
  const combined = [];
  for (const set of sets) {
    for (const comparator of set) {
      combined.push(comparator);
    }
  }
  return combined;
}

function minSatisfyingVersion(comparators) {
  if (!comparators.length) {
    return {
      major: 0,
      minor: 0,
      patch: 0,
      prerelease: [],
      version: '0.0.0'
    };
  }
  let lower = {
    version: { major: 0, minor: 0, patch: 0, prerelease: [], version: '0.0.0' },
    inclusive: true,
    defined: false
  };
  let upper = {
    version: null,
    inclusive: true,
    defined: false
  };
  for (const comparator of comparators) {
    if (comparator.operator === '>=' || comparator.operator === '>') {
      const inclusive = comparator.operator === '>=' && comparator.inclusive;
      if (!lower.defined || compareVersions(comparator.version, lower.version) > 0 || (
        compareVersions(comparator.version, lower.version) === 0 && inclusive && !lower.inclusive
      )) {
        lower = { version: comparator.version, inclusive, defined: true };
      }
      if (!inclusive && lower.inclusive) {
        lower.inclusive = false;
      }
    } else if (comparator.operator === '<=' || comparator.operator === '<') {
      const inclusive = comparator.operator === '<=' && comparator.inclusive;
      if (!upper.defined || compareVersions(comparator.version, upper.version) < 0 || (
        compareVersions(comparator.version, upper.version) === 0 && !inclusive && upper.inclusive
      )) {
        upper = { version: comparator.version, inclusive, defined: true };
      }
      if (!inclusive && upper.inclusive) {
        upper.inclusive = false;
      }
    } else {
      lower = { version: comparator.version, inclusive: true, defined: true };
      upper = { version: comparator.version, inclusive: true, defined: true };
    }
  }
  if (upper.defined && lower.defined) {
    const cmp = compareVersions(lower.version, upper.version);
    if (cmp > 0) return null;
    if (cmp === 0 && (!lower.inclusive || !upper.inclusive)) return null;
  }
  let candidate = lower.defined ? cloneVersion(lower.version) : {
    major: 0,
    minor: 0,
    patch: 0,
    prerelease: [],
    version: '0.0.0'
  };
  if (lower.defined && !lower.inclusive) {
    candidate = incrementPatch(candidate);
  }
  if (upper.defined) {
    const cmp = compareVersions(candidate, upper.version);
    if (cmp > 0) return null;
    if (cmp === 0 && !upper.inclusive) {
      candidate = incrementPatch(candidate);
      if (compareVersions(candidate, upper.version) >= 0) return null;
    }
  }
  if (!satisfiesComparators(candidate, comparators)) {
    let adjusted = cloneVersion(candidate);
    for (let safety = 0; safety < 10; safety += 1) {
      if (satisfiesComparators(adjusted, comparators)) {
        candidate = adjusted;
        break;
      }
      adjusted = incrementPatch(adjusted);
      if (upper.defined && compareVersions(adjusted, upper.version) > 0) {
        return null;
      }
    }
    if (!satisfiesComparators(candidate, comparators)) return null;
  }
  candidate.version = formatVersion(candidate);
  return candidate;
}

function minVersion(range) {
  const sets = parseRange(range);
  if (!sets) return null;
  let candidate = null;
  for (const comparators of sets) {
    const min = minSatisfyingVersion(comparators);
    if (!min) continue;
    if (!candidate || compareVersions(min, candidate) < 0) {
      candidate = min;
    }
  }
  return candidate;
}

function intersects(rangeA, rangeB) {
  const setsA = parseRange(rangeA);
  const setsB = parseRange(rangeB);
  if (!setsA || !setsB) return false;
  for (const setA of setsA) {
    for (const setB of setsB) {
      const combined = combineComparators(setA, setB);
      const min = minSatisfyingVersion(combined);
      if (min) return true;
    }
  }
  return false;
}

function coerce(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    return parseVersionString(String(input));
  }
  const stringInput = String(input);
  const match = stringInput.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const patch = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  return {
    major,
    minor,
    patch,
    prerelease: [],
    version: `${major}.${minor}.${patch}`
  };
}

module.exports = {
  coerce,
  compare: (a, b) => compareVersions(a, b),
  intersects,
  minVersion,
  satisfies
};
