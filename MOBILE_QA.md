# Mobile workspace verification

The mobile layout covers screens up to 960 CSS pixels, including iPhone 15 portrait and landscape. Desktop tables and sidebar are retained above that breakpoint.

## Changes

- Five persistent navigation targets: Home, Leads, Autopilot, Inbox, More. The full navigation uses the existing Radix dialog, with focus restoration and a bottom sheet on mobile.
- Leads become compact cards with independent selection and a button opening the existing detail drawer. Search, filters, bulk selection and pagination use the same state as the desktop table.
- Inbox opens a conversation as a full-screen mobile view, hides background navigation and moves focus to the back button. Returning restores focus to the conversation in the list. Desktop retains the two-column view.
- In landscape, a mobile conversation places history and the manual reply composer beside each other.
- A VisualViewport listener sizes the conversation to Safari's visible area when the keyboard changes its height. It cleans up listeners and CSS values, and does not constrain pinch zoom.
- Inputs use at least 16px text, controls use at least 44px height, and fixed navigation, dialogs and drawers account for safe areas.
- App metadata and a standalone manifest support adding Voxa to the home screen. No service worker or offline storage of private messages is introduced.

## Browser checks performed

A temporary local fixture rendered the actual Workspace and Inbox components in phone-sized frames. All preview fixtures and their temporary framing-header exception were removed before publication. Production framing protection remains DENY.

- Portrait frame 393 × 852; narrow frame 360px; landscape frame 852 × 393.
- Checked page scroll width against viewport width on Dashboard, Leads, Inbox, Integrations, Outreach and Analytics; no page-level horizontal overflow found. Wide report tables scroll within their own container.
- Opened lead details, a new lead form, Excel import and the campaign wizard. Checked dialog widths and closing behavior.
- Selected a page of lead cards and verified shared bulk controls and selection state.
- Opened Inbox conversation, entered an unsent manual response, changed frame width, and verified text remained present.
- Verified full-screen conversation focus, back navigation and focus return; opened the More navigation sheet.
- Verified the landscape conversation with history and composer visible together.

These are browser layout and interaction checks, not a test on a physical iPhone. Native iOS keyboard behavior, the home-screen installation flow and actual notch insets still benefit from a device check. No real outreach, account connection, upload or delivery settings were changed during verification.

Preview image with synthetic data: ../artifacts/voxa-iphone15-preview.jpg.
