const ACTIVE_WEEK_KEY = 'raihan.activeAllocationWeek';
const ADVISORY_KEY_PREFIX = 'raihan.allocationAdvisory.';

function readSessionValue(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // The schedule remains available from the allocation page until it is left.
  }
}

export function getActiveAllocationWeek() {
  const weekNo = Number(readSessionValue(ACTIVE_WEEK_KEY));
  return Number.isInteger(weekNo) && weekNo >= 1 && weekNo <= 41 ? weekNo : 1;
}

export function setActiveAllocationWeek(weekNo) {
  writeSessionValue(ACTIVE_WEEK_KEY, String(weekNo));
}

export function getAllocationAdvisory(weekNo) {
  const serialized = readSessionValue(`${ADVISORY_KEY_PREFIX}${weekNo}`);
  if (!serialized) return null;
  try {
    const advisory = JSON.parse(serialized);
    return advisory?.weekNo === weekNo && Array.isArray(advisory.teachers) ? advisory : null;
  } catch {
    return null;
  }
}

export function setAllocationAdvisory(weekNo, advisory) {
  writeSessionValue(`${ADVISORY_KEY_PREFIX}${weekNo}`, JSON.stringify(advisory));
}

export function clearAllocationAdvisory(weekNo) {
  try {
    sessionStorage.removeItem(`${ADVISORY_KEY_PREFIX}${weekNo}`);
  } catch {
    // Clearing a stale advisory is best-effort when browser storage is blocked.
  }
}
