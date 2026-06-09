import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  server: {
    hmr: { overlay: false },
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      spa: { enabled: true, maskPath: "/" },
      router: {
        autoCodeSplitting: false,
      },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
