import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Voxa Growth",
    short_name: "Voxa",
    description: "Leaduri, campanii și conversații VoxaTech.",
    lang: "ro",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f7",
    theme_color: "#f7f8f7",
    icons: [
      {
        src: "/voxa-mark.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
