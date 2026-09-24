import React from "react";
import Image from "next/image";

/** The existing parent brand stays byte-for-byte unchanged; Recruit is separate. */
export default function RecruitBrand({ className = "" }: { className?: string }) {
  return <div className={`recruit-brand-lockup ${className}`}>
    <Image className="recruit-parent-logo" src="/dropx-logo.png" width={108} height={37} alt="DropX" priority unoptimized />
    <span className="recruit-brand-divider" aria-hidden="true" />
    <span className="recruit-product-logo"><Image src="/brand/recruit-symbol-v1.png" width={40} height={40} alt="" aria-hidden="true" priority unoptimized /><span>Recruit</span></span>
  </div>;
}
