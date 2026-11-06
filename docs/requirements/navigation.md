# Public navigation

### NAV-001: Group public pages around user tasks

MUST: The public header places the logo at the center of the viewport. Desktop navigation groups Use AI and Provide compute on the left. It groups Network and Resources on the right. Account controls remain separate.

MUST: Resources links to Getting Started, Documentation, News, and About Us. News and About Us have working routes. News shows an empty state until posts exist. About Us preserves the project owner's approved mission text.

MUST: A signed-out visitor can reach sign-in from the first viewport. The existing same-site return path rules apply. Provider dashboard links require a signed-in identity. Admin Console links require the server-issued admin flag. Navigation links do not grant authorization.

MUST: Each dropdown supports click, keyboard focus, and Escape. Escape restores focus to its trigger. Navigation, outside clicks, and focus leaving the header close the dropdowns. On narrow screens, categories expand inside a scrollable menu.

MUST: At the top, the brand uses restrained uppercase lettering and a larger icon. The compact icon follows the landscape summit axis on the landing page. It uses the measured image width to scale the optical offset. Other pages use the viewport center. Account controls do not affect either axis. Narrow screens may stack the two words. Scrolling down collapses the wordmark to the centered icon. Returning near the top restores the wordmark. The transition does not move adjacent controls. Reduced-motion users receive the same states without animation.

MUST: Desktop categories use rounded pill triggers. A mouse can open a dropdown by hovering over its category. The pointer can cross the gap into the dropdown without closing it. A short exit delay permits pointer travel. Touch and keyboard controls remain available.

- Principle: P2, P6, P8
- Status: implemented
- Verified by: web/src/lib/nav.test.mjs, web/src/lib/landscape-geometry.test.mjs

### NAV-002: Show an illustrative connection across the landscape

MUST: All five landing chapters show Use AI and Provide compute on opposite banks. A quiet animated line connects them. The layer follows the landscape framing behind the chapter text and tetrahedrons. It does not intercept pointer input or indicate actual request activity. Narrow screens hide the bank labels to keep the chapter text clear.

MUST: The connection has no play or pause button. The moving marker stays circular at all landscape aspect ratios. Reduced-motion settings stop the animation. The connection fades with the landscape during the final exit. The existing chapter copy, video colors, and security claims remain unchanged.

- Principle: P2, P8
- Status: implemented
- Verified by: web/src/lib/landscape-geometry.test.mjs

### NAV-003: Give consumers and providers distinct landing actions

MUST: The opening and final landing button groups use the same actions. Use the API leads to `/keys`. Provide compute leads to `/provide`. Explore the exchange leads to `/exchange`.

MUST: Signed-out visitors go through sign-in for `/keys` and `/provide`. The sign-in URL preserves the intended destination. Signed-in visitors go directly to that destination. Exchange discovery does not require sign-in.

- Principle: P6, P8
- Status: implemented
- Verified by: web/src/lib/nav.test.mjs, web/src/lib/hero-editorial.test.mjs
