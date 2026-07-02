import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vimob CRM",
    short_name: "Vimob",
    description: "CRM imobiliario Vimob",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#FF4529",
    icons: [
      {
        src: "/icons/favicon-laranja.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/favicon-laranja.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
