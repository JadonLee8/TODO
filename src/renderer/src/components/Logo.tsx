/**
 * The app's mark, "Commit check" (build/logo.svg): a check drawn as three commits, the newest one highlighted.
 * Drawn in the theme's colors (see `.logo` in global.css), so it suits every theme.
 */
export default function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path className="logo-line" d="M14 34 L27 47 L50 17" strokeWidth="5" strokeLinejoin="round" />
      <circle className="logo-commit" cx="14" cy="34" r="5.5" strokeWidth="4" />
      <circle className="logo-commit" cx="27" cy="47" r="5.5" strokeWidth="4" />
      <circle className="logo-head" cx="50" cy="17" r="8" strokeWidth="4" />
    </svg>
  )
}
