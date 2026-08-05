import logoUrl from "@/assets/mascot/mdview-transpa-bg.png";

type LogoProps = {
  size?: number;
  title?: string;
};

/**
 * marka.md brand mark — the M-shaped cube tower with the orange octopus mascot.
 */
export function Logo({ size = 22, title = "marka.md" }: LogoProps) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={title}
      draggable={false}
      style={{ display: "block", userSelect: "none" }}
    />
  );
}
