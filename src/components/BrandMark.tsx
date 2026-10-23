const SIZES = {
  sm: "h-8 w-8 rounded-lg text-[0.95rem]",
  md: "h-9 w-9 rounded-lg text-base",
  lg: "h-16 w-16 rounded-2xl text-3xl",
} as const;

export default function BrandMark({ size = "md" }: { size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-nhra-red font-display font-bold text-white ${SIZES[size]}`}
      style={{
        backgroundImage: "linear-gradient(140deg, #ea3a55 0%, #c8102e 52%, #970b23 100%)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.22), inset 0 -2px 6px rgb(0 0 0 / 0.22), 0 1px 2px rgb(0 0 0 / 0.4)",
      }}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
      <span className="relative -skew-x-8 tracking-tight">TD</span>
    </span>
  );
}
