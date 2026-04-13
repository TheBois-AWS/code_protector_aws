export function paginate(items = [], { page = 1, pageSize = 20 } = {}) {
  const total = Array.isArray(items) ? items.length : 0;
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total,
    start,
    end,
    data: items.slice(start, end)
  };
}
