export function groupTodosByDate(items, getDate, today) {
  const groups = new Map();

  for (const item of items) {
    const date = getDate(item) || "1970-01-01";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }

  return Array.from(groups.entries()).sort(([dateA], [dateB]) => {
    if (dateA === today) return -1;
    if (dateB === today) return 1;
    return String(dateA).localeCompare(String(dateB));
  });
}
