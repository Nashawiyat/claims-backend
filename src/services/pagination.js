"use strict";
/**
 * Pagination & sorting helper returning unified API response shape.
 */
module.exports.paginate = async function paginate(modelQuery, countQuery, { page, limit, sortBy, sortDir, status }) {
  const safePage = Math.max(parseInt(page,10)||1,1);
  const safeLimit = Math.min(Math.max(parseInt(limit,10)||10,1),100);
  const skip = (safePage-1)*safeLimit;
  if (sortBy) {
    const dir = sortDir === 'desc' ? -1 : 1;
    modelQuery = modelQuery.sort({ [sortBy]: dir });
  }
  modelQuery = modelQuery.skip(skip).limit(safeLimit);
  const [items, totalItems] = await Promise.all([
    modelQuery,
    typeof countQuery === 'function' ? countQuery() : countQuery
  ]);
  const totalPages = Math.ceil(totalItems / safeLimit) || 1;
  return {
    success: true,
    data: {
      items,
      page: safePage,
      limit: safeLimit,
      totalItems,
      totalPages,
      ...(sortBy ? { sortBy } : {}),
      ...(sortDir ? { sortDir } : {}),
      ...(status ? { status } : {})
    }
  };
};
