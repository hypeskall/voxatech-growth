import Image from "next/image";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image src="/voxa-mark.png" alt="" width={64} height={64} priority />
    </span>
  );
}
