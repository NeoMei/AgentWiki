/** Decorative mark: the enclosing brand link or heading supplies its accessible name. */
export const BrandMark = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <img src="/brand/agentwiki-knot-v1.png" width={size} height={size} alt="" className={`shrink-0 object-contain ${className}`} />
);
