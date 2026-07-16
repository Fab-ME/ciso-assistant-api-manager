export const state = {
  items: [],
  exportItems: [],
  rows: [],
  columns: [],
  options: {},
  columnFilters: {},
  visibleColumns: new Set(),
  exportColumns: new Set(),
  currentColumnSignature: "",
  sort: { column: null, direction: "asc" },
  page: 1,
  pageSize: 100,
  domainsDraft: [],
  rolesDraft: [],
};

export const TECHNICAL_COLUMNS = new Set([
  "created_at", "updated_at", "created_by", "modified_by", "etag", "repr", "str",
]);
