const SIZES = {
  sm: "h-8 w-8 rounded-lg text-[0.95rem]",
  md: "h-10 w-10 rounded-xl text-lg",
  lg: "h-16 w-16 rounded-2xl text-3xl",
} as const;

export default function BrandMark({ size = "md" }: { size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-nhra-red font-display font-bold text-white ${SIZES[size]}`}
      style={{
        backgroundImage: "linear-gradient(140deg, #f0415a 0%, #c8102e 48%, #8c0a20 100%)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 -2px 6px rgb(0 0 0 / 0.25), 0 8px 22px -10px rgb(200 16 46 / 0.8)",
      }}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
      <span className="relative -skew-x-8 tracking-tight">TD</span>
    </span>
  );
}
