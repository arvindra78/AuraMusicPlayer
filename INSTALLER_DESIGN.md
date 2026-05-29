# Aura Music Player Installer Design Specification

## 1. Visual Identity & Branding
*   **App Name:** Aura Music Player
*   **Version:** 3.3.2
*   **Tagline:** "Listen. Feel. Flow."
*   **Primary Theme:** Modern Dark (Obsidian & Deep Purple)
*   **Accent Gradient:** `#7C8AFF` (Blue) → `#A78BFA` (Purple) → `#F472B6` (Pink)

## 2. Screen-by-Screen Flow

### Screen 1: Welcome (The Introduction)
*   **Header:** Aura Logo (Left), "Aura Music Player v3.3.2" (Right)
*   **Center:** High-resolution branding image with the tagline "Listen. Feel. Flow."
*   **Description:** "Welcome to the future of local music playback. Aura provides a high-fidelity, polished experience for your entire music library."
*   **Actions:** [Next] (Install), [Cancel]

### Screen 2: Installation Options (The Setup)
*   **Selection:** Destination Folder selection with "Browse..." button.
*   **Disk Metrics:** Real-time display of "Space Required" (240MB) and "Space Available".
*   **Toggles:**
    *   [x] Create Desktop Shortcut
    *   [x] Add to Start Menu
    *   [x] Register as default player for MP3, FLAC, and WAV
*   **Actions:** [Install], [Back], [Cancel]

### Screen 3: Installation Progress (The Extraction)
*   **Animation:** Glowing purple progress bar.
*   **Status:** "Deploying AudioEngine DSP...", "Optimizing UI assets...", "Registering file associations..."
*   **Detail:** Displaying current file path being extracted.

### Screen 4: Completion (The Launch)
*   **Visual:** Large success icon (Green checkmark with purple glow).
*   **Message:** "Aura is ready."
*   **Option:** [x] Launch Aura Music Player immediately.
*   **Actions:** [Finish]

## 3. Component Hierarchy
*   **MainFrame:** 640x480, 24px Rounded Corners (via NSIS Modern UI 2).
*   **Sidebar:** Branding strip with "Listen. Feel. Flow." text.
*   **ButtonSet:** Primary (Purple Gradient), Secondary (Ghost/Transparent).

## 4. UI/UX Suggestions
*   **Transitions:** Fade-in effect for each page.
*   **Micro-interactions:** Hover effects on the "Install" button with a slight glow expansion.
*   **Progress:** Non-linear progress bar animation (fast start, smooth settle).
