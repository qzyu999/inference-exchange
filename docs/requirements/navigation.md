# Public navigation

### NAV-001: Group public pages around user tasks

MUST: The public header places the logo at the center of the viewport. Desktop navigation groups Use AI and Provide compute on the left. It groups Network and Resources on the right. Account controls remain separate.

MUST: Resources links to Getting Started, Documentation, News, and About Us. News and About Us have working routes. News shows an empty state until posts exist. About Us preserves the project owner's approved mission text.

MUST: A signed-out visitor can reach sign-in from the first viewport. The existing same-site return path rules apply. Provider dashboard links require a signed-in identity. Admin Console links require the server-issued admin flag. Navigation links do not grant authorization.

MUST: Each dropdown supports click, keyboard focus, and Escape. Escape restores focus to its trigger. Navigation, outside clicks, and focus leaving the header close the dropdowns. On narrow screens, categories expand inside a scrollable menu.

MUST: At the top, uppercase brand lettering has the same visible height as its icon. Narrow screens may stack the two words. Scrolling down collapses the wordmark to the centered icon. Returning near the top restores the wordmark. The transition does not move adjacent controls. Reduced-motion users receive the same states without animation.

- Principle: P2, P6, P8
- Status: implemented
- Verified by: web/src/lib/nav.test.mjs
