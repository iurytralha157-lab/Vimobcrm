import Image from "next/image";

export function HomeBrandBanner() {
  return (
    <Image
      src="/images/vimob-home-banner.svg"
      alt="Vimob. Toda a sua operação em um só lugar. Leads, conversas, imóveis e agenda conectados. Acompanhe cada oportunidade do primeiro contato até o contrato assinado."
      width={2070}
      height={228}
      loading="eager"
      className="block h-auto w-full object-contain"
      unoptimized
    />
  );
}
