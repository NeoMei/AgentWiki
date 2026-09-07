-- Aliases preserve original v1 portable paths when current Pages move into pages/.
-- Application writers still validate the full portable Markdown path and its key.
-- The public 1024-byte budget applies to the original path. Full Unicode
-- casefold keys may expand, so their contract requires nonempty, not that budget.
ALTER TABLE "PagePathAlias" DROP CONSTRAINT "PagePathAlias_non_empty_path";
ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_non_empty_path"
  CHECK (
    octet_length("path") BETWEEN 1 AND 1024
    AND octet_length("pathKey") > 0
    AND "path" !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]:\\])'
    AND "pathKey" !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]:\\])'
  );
