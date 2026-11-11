/** Plain-language drafts. Must be reviewed by counsel (Kenya Data Protection Act, 2019) before public launch. */
export const privacyHtml = (contact: string) => `
<h1>Privacy policy</h1>
<p><em>Draft for legal review.</em></p>
<h2>What we collect</h2>
<ul>
  <li>Account details: email and/or phone number, username, display name, password (stored only as an Argon2id hash).</li>
  <li>Profile details you choose to add: photo, bio, location, fitness interests.</li>
  <li>Activity data when you record walks or runs: GPS points, times, distance and pace. Step counts only if you connect Health Connect or Apple Health.</li>
  <li>Security data: sign-in history, device information and IP addresses, used to protect your account.</li>
</ul>
<h2>How we use it</h2>
<p>To provide the service, keep your account secure, show your activities to the audiences you choose, and operate clubs you join. We do not sell personal data.</p>
<h2>Your controls</h2>
<ul>
  <li>Profile visibility: public, followers only or private. Route start and end points are hidden by default.</li>
  <li>Your personal activities belong to you, not to any club. Leaving a club never deletes your history.</li>
  <li>Export your data or delete your account at any time from Settings. Deletion completes after a 30-day grace period.</li>
</ul>
<h2>Your rights</h2>
<p>Under the Kenya Data Protection Act, 2019 you may access, correct, port and request deletion of your personal data, and object to certain processing. Contact <a href="mailto:${contact}">${contact}</a>.</p>`;

export const termsHtml = () => `
<h1>Terms of service</h1>
<p><em>Draft for legal review.</em></p>
<h2>Using WalkTogether</h2>
<p>You must provide accurate information, keep your credentials safe and follow club rules and our community guidelines. Don’t harass others, spoof activity data or misuse the platform.</p>
<h2>Health &amp; safety</h2>
<p>WalkTogether is not a medical service. Calorie and fitness estimates are approximations. Listen to your body, follow local laws and stay safe, especially on roads and at night.</p>
<h2>Clubs</h2>
<p>Club owners are responsible for their club’s content, events and conduct. Clubs may only use member information to operate the club.</p>
<h2>Paid plans</h2>
<p>Club and individual subscriptions are separate. Paid features end when a subscription expires; your personal data and basic tracking remain available.</p>
<h2>Sponsored content</h2>
<p>Sponsored challenges and events are clearly labelled and have their own published rules and eligibility criteria.</p>`;
