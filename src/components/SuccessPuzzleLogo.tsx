export function SuccessPuzzleLogo() {
  return (
    <svg className="success-logo" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="logo-shell" x1="10" y1="7" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#244b78" />
          <stop offset=".5" stopColor="#102440" />
          <stop offset="1" stopColor="#081528" />
        </linearGradient>
        <linearGradient id="logo-top" x1="18" y1="13" x2="46" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffe7a7" />
          <stop offset=".5" stopColor="#d6a348" />
          <stop offset="1" stopColor="#9a6724" />
        </linearGradient>
        <linearGradient id="logo-left" x1="14" y1="23" x2="33" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d4a043" />
          <stop offset="1" stopColor="#75501f" />
        </linearGradient>
        <linearGradient id="logo-right" x1="32" y1="30" x2="51" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f0c66f" />
          <stop offset="1" stopColor="#9a6828" />
        </linearGradient>
        <filter id="logo-depth" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="5" stdDeviation="3" floodColor="#020914" floodOpacity=".55" />
        </filter>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#logo-shell)" />
      <path d="M8 21C13 11 21 7 32 7c12 0 21 6 25 17" fill="none" stroke="#fff" strokeOpacity=".17" strokeWidth="2" />
      <g filter="url(#logo-depth)">
        <path d="M32 13 49 22.5 32 32 15 22.5 32 13Z" fill="url(#logo-top)" />
        <path d="M15 22.5 32 32v19L15 41.5v-19Z" fill="url(#logo-left)" />
        <path d="M49 22.5 32 32v19l17-9.5v-19Z" fill="url(#logo-right)" />
        <circle cx="32" cy="13.3" r="4.1" fill="#ffe9af" />
        <circle cx="49" cy="31.8" r="4.1" fill="#dca94d" />
        <path d="M24.2 26.8 32 31l7.8-4.2" fill="none" stroke="#fff8df" strokeOpacity=".62" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <path d="m27 39 3.2 1.1 1.1 3.2 1.2-3.2 3.1-1.1-3.1-1.2-1.2-3.1-1.1 3.1L27 39Z" fill="#fff6d8" />
    </svg>
  );
}
