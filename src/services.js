// Every service Chat Manager can host. Loaded by the window (index.html) and
// by the main process (require), so both agree on how each service behaves.
//
//   url         page an account opens on
//   color       default account colour and the service marker colour
//   unread      where the unread count comes from: 'title' and/or 'badge'
//               (navigator.setAppBadge). With both, the higher one wins.
//   titleCount  pattern for a count in the page title (default: "(3) ...")
//   titleDot    pattern for "something unread" without a count; shows a dot
//   hosts       sites the account may move between inside the app; links to
//               anything else open in the browser
//   sso         true when sign-in can go through a company's own login page,
//               so the account may move to any site; its own pop-out windows
//               (hosts) and blank popups also open inside the app
//   reloadOn    console message that means the page is stuck; reload it
//   signIn      { when, url }: when the account lands on a page matching
//               `when` (a signed-out product page), open `url` to sign in
//   keeps       what stays safe when the account is removed from the app
//   hint        sign-in tip shown in the Add account dialog
(function () {
  const SERVICES = {
    whatsapp: {
      label: 'WhatsApp',
      url: 'https://web.whatsapp.com/',
      color: '#25D366',
      unread: ['title'],
      hosts: ['web.whatsapp.com'],
      keeps: 'Your chats stay on your phone.',
      hint: 'scan the QR code with that phone (WhatsApp → Linked devices).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Zm4.4 12.4c-.2.5-1.1 1-1.6 1-.4.1-.9.1-1.5-.1-.3-.1-.8-.3-1.4-.5-2.4-1-4-3.5-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.6-.3h.5c.1 0 .3 0 .5.4l.7 1.7c.1.1.1.3 0 .4l-.3.4-.3.3c-.1.1-.2.3-.1.5.2.3.7 1.1 1.4 1.7.9.8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.6-.8c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z"/></svg>',
    },
    telegram: {
      label: 'Telegram',
      url: 'https://web.telegram.org/a/',
      color: '#2AABEE',
      unread: ['badge'],
      hosts: ['web.telegram.org'],
      keeps: 'Your chats stay in your Telegram account.',
      hint: 'scan the QR code in Telegram on your phone (Settings → Devices → Add Device), or log in with your phone number.',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21.4 4.3 2.9 11.4c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.8-1.4-1.4ZM8.7 14.1l9.6-6.1c.5-.3.9-.1.5.2l-8 7.3-.3 3.4-1.8-4.8Z"/></svg>',
    },
    teams: {
      label: 'Teams',
      fullName: 'Microsoft Teams',
      url: 'https://teams.microsoft.com/v2/',
      color: '#5B5FC7',
      unread: ['title', 'badge'],
      hosts: ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'],
      sso: true,
      // Teams' startup loader sometimes gives up on a cold start and leaves a blank page.
      reloadOn: /Pre-loader startup failed/,
      keeps: 'Your chats stay in your Microsoft account.',
      hint: 'sign in with your Microsoft work, school, or personal account.',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h9A1.5 1.5 0 0 1 15 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-9Zm3 2.2v1.6h2.2V15h1.6v-4.7H12V8.7H6Zm10 .3h3.5c.8 0 1.5.7 1.5 1.5v4a3.5 3.5 0 0 1-5 3.2V9Zm2-1.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-6-3a2.3 2.3 0 0 0-2.2 1.5H12c.4 0 .8.1 1.2.3A2.3 2.3 0 0 0 12 4.5Z"/></svg>',
    },
    slack: {
      label: 'Slack',
      url: 'https://app.slack.com/client',
      color: '#611F69',
      unread: ['title', 'badge'],
      // Slack marks unread with "*" (and mentions with "!") at the start of the title.
      titleDot: /^[*!]\s/,
      hosts: ['slack.com'],
      sso: true,
      keeps: 'Your messages stay in your Slack workspace.',
      hint: 'sign in to your Slack workspace (email, Google, Apple, or your company sign-in).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.5 3A1.5 1.5 0 0 1 11 4.5V8h2V4.5a1.5 1.5 0 0 1 3 0V8h3.5a1.5 1.5 0 0 1 0 3H16v2h3.5a1.5 1.5 0 0 1 0 3H16v3.5a1.5 1.5 0 0 1-3 0V16h-2v3.5a1.5 1.5 0 0 1-3 0V16H4.5a1.5 1.5 0 0 1 0-3H8v-2H4.5a1.5 1.5 0 0 1 0-3H8V4.5A1.5 1.5 0 0 1 9.5 3Zm1.5 8v2h2v-2h-2Z"/></svg>',
    },
    messenger: {
      label: 'Messenger',
      url: 'https://www.messenger.com/',
      color: '#0084FF',
      unread: ['title', 'badge'],
      hosts: ['messenger.com', 'facebook.com'],
      keeps: 'Your chats stay in your Facebook account.',
      hint: 'log in with your Facebook account.',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.5c-5.4 0-9.5 3.9-9.5 8.9 0 2.8 1.3 5.2 3.4 6.8v3.3l3.1-1.7c.9.2 1.9.4 3 .4 5.4 0 9.5-3.9 9.5-8.8S17.4 2.5 12 2.5Zm1 11.9-2.4-2.6-4.7 2.6 5.2-5.5 2.5 2.6 4.6-2.6-5.2 5.5Z"/></svg>',
    },
    facebook: {
      label: 'Facebook',
      url: 'https://www.facebook.com/',
      color: '#1877F2',
      unread: ['title', 'badge'],
      hosts: ['facebook.com', 'fb.com'],
      keeps: 'Your account is not affected.',
      hint: 'log in with your Facebook account.',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>',
    },
    instagram: {
      label: 'Instagram',
      url: 'https://www.instagram.com/direct/inbox/',
      color: '#E1306C',
      unread: ['title', 'badge'],
      hosts: ['instagram.com', 'facebook.com'],
      keeps: 'Your account is not affected.',
      hint: 'log in with your Instagram account (or with Facebook).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7.5 2.5h9a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3h-9ZM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5-3.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"/></svg>',
    },
    linkedin: {
      label: 'LinkedIn',
      url: 'https://www.linkedin.com/feed/',
      color: '#0A66C2',
      unread: ['title', 'badge'],
      hosts: ['linkedin.com'],
      keeps: 'Your account is not affected.',
      hint: 'sign in with your LinkedIn account (or with Google or Apple).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3 8.5h3V21H3V8.5Zm5 0h2.9v1.7h.1c.4-.8 1.4-1.9 3.1-1.9 3.3 0 3.9 2.2 3.9 5V21h-3v-6.9c0-1.6 0-3.7-2.3-3.7s-2.6 1.8-2.6 3.6v7H8V8.5Z"/></svg>',
    },
    x: {
      label: 'X',
      fullName: 'X (Twitter)',
      url: 'https://x.com/home',
      color: '#000000',
      unread: ['title', 'badge'],
      hosts: ['x.com', 'twitter.com'],
      keeps: 'Your account is not affected.',
      hint: 'sign in with your X account (or with Google or Apple).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
    },
    discord: {
      label: 'Discord',
      url: 'https://discord.com/app',
      color: '#5865F2',
      unread: ['title', 'badge'],
      // Discord shows "(3)" for mentions and a leading "•" for other unread messages.
      titleDot: /^•\s?/,
      hosts: ['discord.com'],
      keeps: 'Your messages stay in your Discord account.',
      hint: 'log in with your Discord account, or scan the QR code with the Discord app.',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.3 5.3A16.4 16.4 0 0 0 15.2 4l-.5 1a15 15 0 0 0-5.4 0l-.5-1a16.4 16.4 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.8a16.6 16.6 0 0 0 5 2.5l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a11.8 11.8 0 0 0 11 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.4-4.4-.7-8.2-3-11.5ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>',
    },
    gmail: {
      label: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
      color: '#EA4335',
      unread: ['title', 'badge'],
      // "Inbox (3) - you@gmail.com - Gmail"
      titleCount: /\((\d+)\)/,
      // Google Workspace accounts may sign in through a company login page.
      hosts: ['mail.google.com'],
      sso: true,
      keeps: 'Your email stays in your Google account.',
      hint: 'sign in with your Google account (Gmail or Google Workspace).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3.5 5h17A1.5 1.5 0 0 1 22 6.5v11a1.5 1.5 0 0 1-1.5 1.5H18V9.8l-6 4.5-6-4.5V19H3.5A1.5 1.5 0 0 1 2 17.5v-11A1.5 1.5 0 0 1 3.5 5Zm.9 1.8L12 12.5l7.6-5.7H4.4Z"/></svg>',
    },
    googlechat: {
      label: 'Google Chat',
      url: 'https://chat.google.com/',
      color: '#00AC47',
      // Signed out, Google Chat shows a product page; go to Google sign-in instead.
      signIn: {
        when: /^https:\/\/workspace\.google\.com\/(intl\/[^/]+\/)?products\/chat/,
        url: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fchat.google.com%2F&followup=https%3A%2F%2Fchat.google.com%2F',
      },
      unread: ['title', 'badge'],
      titleCount: /\((\d+)\)/,
      hosts: ['chat.google.com'],
      sso: true,
      keeps: 'Your chats stay in your Google account.',
      hint: 'sign in with your Google account (Gmail or Google Workspace).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4.5 3h15A1.5 1.5 0 0 1 21 4.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V4.5A1.5 1.5 0 0 1 4.5 3ZM7 8v2h10V8H7Zm0 3.5v2h7v-2H7Z"/></svg>',
    },
    outlook: {
      label: 'Outlook',
      fullName: 'Outlook (Microsoft mail)',
      url: 'https://outlook.office.com/mail/',
      color: '#0078D4',
      // Outlook on the web is an installable web app and sets the app badge.
      unread: ['badge', 'title'],
      titleCount: /\((\d+)\)/,
      hosts: ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'],
      sso: true,
      keeps: 'Your email stays in your Microsoft account.',
      hint: 'sign in with your Microsoft work, school, or personal account (Outlook.com, Hotmail, Live).',
      icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 5h7.5A1.5 1.5 0 0 1 22 6.5v11a1.5 1.5 0 0 1-1.5 1.5H13v-6.2l2.2 1.6L21 10V7.6l-5.8 4.1L13 10.2V5ZM2 4.8 12 3v18L2 19.2V4.8Zm5 3.7c-1.7 0-2.8 1.5-2.8 3.5s1.1 3.5 2.8 3.5 2.8-1.5 2.8-3.5S8.7 8.5 7 8.5Zm0 1.6c.7 0 1.1.8 1.1 1.9s-.4 1.9-1.1 1.9-1.1-.8-1.1-1.9.4-1.9 1.1-1.9Z"/></svg>',
    },
  };

  // Sign-in pages any service may use ("Continue with Google/Apple/Microsoft").
  // They open inside the app so the login lands in the right account.
  const SIGN_IN_HOSTS = [
    'accounts.google.com', 'appleid.apple.com',
    'login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'account.live.com',
  ];

  const api = { SERVICES, SIGN_IN_HOSTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(window, api);
})();
