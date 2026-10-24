import { createTheme, Modal } from "@mantine/core";

// App-wide design tokens live here (see docs/FRONTEND.md).
export const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  components: {
    // Softer backdrop (default is a flat 60%-opacity black) for every modal
    // in the app, including confirm dialogs from @mantine/modals.
    Modal: Modal.extend({
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.35, blur: 2 },
      },
    }),
  },
});
