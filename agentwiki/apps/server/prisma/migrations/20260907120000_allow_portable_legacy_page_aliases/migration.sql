-- Aliases preserve original v1 portable paths when current Pages move into pages/.
-- Application writers still validate the full portable Markdown path and its key.
ALTER TABLE "PagePathAlias" DROP CONSTRAINT "PagePathAlias_non_empty_path";
ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_non_empty_path"
  CHECK (
    octet_length("path") BETWEEN 1 AND 1024
    AND octet_length("pathKey") BETWEEN 1 AND 1024
    AND "path" !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]:\\])'
    AND "pathKey" !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]:\\])'
  );
