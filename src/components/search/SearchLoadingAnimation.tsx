const SearchLoadingAnimation = () => {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="relative w-16 h-16">
        <svg
          viewBox="0 0 100 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full overflow-visible"
        >
          {/* Left wing + feather grouped for shared transform-origin */}
          <g className="vrelly-left-wing">
            <path
              d="M50 70 C45 55, 30 40, 5 20 C15 25, 30 28, 45 50 Z"
              fill="url(#leftGrad)"
            />
            <path
              d="M50 65 C42 50, 25 38, 10 28 C20 32, 35 38, 48 55 Z"
              fill="url(#leftGradLight)"
            />
          </g>
          {/* Right wing + feather grouped for shared transform-origin */}
          <g className="vrelly-right-wing">
            <path
              d="M50 70 C55 55, 70 40, 95 20 C85 25, 70 28, 55 50 Z"
              fill="url(#rightGrad)"
            />
            <path
              d="M50 65 C58 50, 75 38, 90 28 C80 32, 65 38, 52 55 Z"
              fill="url(#rightGradLight)"
            />
          </g>
          <defs>
            <linearGradient id="leftGrad" x1="5" y1="20" x2="50" y2="70" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3B82F6" />
              <stop offset="1" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="leftGradLight" x1="10" y1="28" x2="50" y2="65" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60A5FA" />
              <stop offset="1" stopColor="#2563EB" />
            </linearGradient>
            <linearGradient id="rightGrad" x1="95" y1="20" x2="50" y2="70" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3B82F6" />
              <stop offset="1" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="rightGradLight" x1="90" y1="28" x2="50" y2="65" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60A5FA" />
              <stop offset="1" stopColor="#2563EB" />
            </linearGradient>
          </defs>
        </svg>
        {/* Subtle shadow that pulses with the flap */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1.5 rounded-full bg-blue-200/40 animate-[shadowPulse_0.8s_ease-in-out_infinite]" />
      </div>
      <p className="text-sm text-muted-foreground animate-pulse tracking-wide">
        Searching...
      </p>

      <style>{`
        .vrelly-left-wing {
          transform-origin: 50px 70px;
          animation: flapLeft 0.8s ease-in-out infinite;
        }
        .vrelly-right-wing {
          transform-origin: 50px 70px;
          animation: flapRight 0.8s ease-in-out 0.05s infinite;
        }
        @keyframes flapLeft {
          0%, 100% {
            transform: rotateZ(0deg);
          }
          50% {
            transform: rotateZ(-20deg);
          }
        }
        @keyframes flapRight {
          0%, 100% {
            transform: rotateZ(0deg);
          }
          50% {
            transform: rotateZ(20deg);
          }
        }
        @keyframes shadowPulse {
          0%, 100% {
            transform: translateX(-50%) scaleX(1);
            opacity: 0.4;
          }
          50% {
            transform: translateX(-50%) scaleX(0.6);
            opacity: 0.2;
          }
        }
      `}</style>
    </div>
  );
};

export default SearchLoadingAnimation;
