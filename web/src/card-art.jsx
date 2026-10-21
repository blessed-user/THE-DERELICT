// THE DERELICT — card faces.
//
// Six woodcut faces, drawn here rather than imported: a fist, a palm, a pair
// of fingers, and the three powers of the back room. Kaiji-adjacent, not a
// copy — no faces and no logos, just hands, a cap, a mask and a crown.

const LINE = {
  stroke: 'currentColor',
  strokeWidth: 2.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const HAIR = {
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  fill: 'none',
  opacity: 0.38,
};

function Face({ kind, children }) {
  return (
    <svg
      className={`card-art-svg art-${kind}`}
      viewBox="0 0 100 120"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Rock — a closed fist, knuckles toward the table.
function Rock() {
  return (
    <Face kind="rock">
      <g {...LINE} fill="rgba(183, 122, 85, 0.18)">
        <path d="M28 94V60q0-14 13-14h18q13 0 13 14v34Z" />
        <rect x="31" y="36" width="9" height="26" rx="4.5" />
        <rect x="41.5" y="30" width="9" height="32" rx="4.5" />
        <rect x="52" y="33" width="9" height="29" rx="4.5" />
        <rect x="62.5" y="39" width="9" height="23" rx="4.5" />
        <rect x="21" y="65" width="23" height="11" rx="5.5" transform="rotate(-24 32 70)" />
        <rect x="31" y="94" width="38" height="11" rx="2.5" />
      </g>
      <g {...HAIR}>
        <path d="M34 58h6M45 53h6M56 55h6M66 60h4" />
        <path d="M34 76l9 9M44 70l9 9M54 68l8 8" />
        <path d="M35 100h30" />
        <path d="M24 45l-7-7M27 38l-4-8" opacity="0.7" />
      </g>
    </Face>
  );
}

// Paper — an open palm, fingers spread.
function Paper() {
  return (
    <Face kind="paper">
      <g {...LINE} fill="rgba(170, 179, 163, 0.16)">
        <path d="M34 60q0-8 8-8h16q8 0 8 8v28q0 8-8 8H42q-8 0-8-8Z" />
        <rect x="36" y="24" width="7.5" height="34" rx="3.75" />
        <rect x="45.5" y="16" width="7.5" height="42" rx="3.75" />
        <rect x="55" y="20" width="7.5" height="38" rx="3.75" />
        <rect x="64.5" y="31" width="7.5" height="27" rx="3.75" />
        <rect x="17" y="64" width="20" height="8" rx="4" transform="rotate(-38 30 70)" />
        <rect x="40" y="95" width="20" height="10" rx="2" />
      </g>
      <g {...HAIR}>
        <path d="M42 74q8 6 16 0M40 84q10 7 20 0M46 58v12" />
        <path d="M41 27v-6M50 19v-6M59 23v-6M68 34v-5" opacity="0.7" />
      </g>
    </Face>
  );
}

// Scissors — two fingers, the blade of the hand.
function Scissors() {
  return (
    <Face kind="scissors">
      <g {...LINE} fill="rgba(255, 122, 24, 0.17)">
        <rect x="34" y="66" width="32" height="27" rx="11" />
        <rect x="43" y="16" width="7.5" height="50" rx="3.75" transform="rotate(-15 47 66)" />
        <rect x="50" y="16" width="7.5" height="50" rx="3.75" transform="rotate(15 53 66)" />
        <rect x="29" y="74" width="23" height="8" rx="4" transform="rotate(-8 40 78)" />
        <rect x="37" y="92" width="26" height="10" rx="2" />
      </g>
      <g {...HAIR}>
        <path d="M35 78l8 7M48 80h9M43 97h14" />
        <path d="M40 14l-6-6M60 14l6-6" opacity="0.7" />
      </g>
    </Face>
  );
}

// Crown — the heavy thing the back room is fought over.
function Crown() {
  return (
    <Face kind="crown">
      <circle cx="50" cy="60" r="33" fill="currentColor" opacity="0.05" />
      <g {...LINE} fill="rgba(217, 183, 116, 0.18)">
        <path d="M20 82 24 44l14 16 12-30 12 30 14-16 4 38Z" />
        <rect x="20" y="80" width="60" height="14" rx="2" />
      </g>
      <g fill="currentColor">
        <circle cx="24" cy="44" r="2.6" />
        <circle cx="50" cy="30" r="2.8" />
        <circle cx="76" cy="44" r="2.6" />
        <circle cx="32" cy="87" r="2.1" />
        <circle cx="50" cy="87" r="2.4" />
        <circle cx="68" cy="87" r="2.1" />
      </g>
      <g {...HAIR}>
        <path d="M30 78V64M40 74V56M60 74V56M70 78V64" />
        <path d="M24 86h52" />
        <path d="M36 102h28" opacity="0.7" />
      </g>
    </Face>
  );
}

// Citizen — cap down, collar up, eyes on the deck.
function Citizen() {
  return (
    <Face kind="citizen">
      <g {...LINE} fill="rgba(185, 169, 141, 0.15)">
        <circle cx="50" cy="40" r="11.5" />
        <path d="M35 33q15-13 30 0l-2 5H37Z" />
        <path d="M31 38h38" />
        <path d="M43 50h14v7H43Z" />
        <path d="M23 100q2-28 15-39h24q13 11 15 39Z" />
        <path d="M40 61l10 10 10-10" fill="none" />
      </g>
      <g fill="currentColor" opacity="0.55">
        <circle cx="50" cy="76" r="1.7" />
        <circle cx="50" cy="84" r="1.7" />
      </g>
      <g {...HAIR}>
        <path d="M36 68v28M64 68v28M40 88h20" />
        <path d="M38 39h-9" opacity="0.7" />
      </g>
    </Face>
  );
}

// Rebel — mask up, fist raised, nothing left to lose.
function Rebel() {
  return (
    <Face kind="rebel">
      <g {...LINE} fill="rgba(210, 74, 50, 0.18)">
        <circle cx="50" cy="42" r="11.5" />
        <path d="M36 29l3-13 6 9 5-14 5 12 5-9 2 15Z" />
        <path d="M37 45q13 7 26 0l-1 8q-12 7-24 0Z" />
        <path d="M43 54h14v6H43Z" />
        <path d="M24 100q2-29 15-39h22q13 10 15 39Z" />
        <path d="M40 64l10 9 10-9" fill="none" />
      </g>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M42 40h6M54 40h6" />
      </g>
      <path
        d="M38 65q-13 3-16 17"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <g {...LINE} fill="rgba(210, 74, 50, 0.18)">
        <path d="M61 74l9-12" strokeWidth="4" />
        <rect x="69" y="50" width="13" height="11" rx="3.5" />
      </g>
      <g {...HAIR}>
        <path d="M72 50v-4M77 50v-5M82 51v-3M70 61h11" />
        <path d="M38 68v26M62 68v26M46 97h12" />
      </g>
    </Face>
  );
}

const FACES = {
  rock: Rock,
  paper: Paper,
  scissors: Scissors,
  crown: Crown,
  citizen: Citizen,
  rebel: Rebel,
};

export function CardArt({ card }) {
  const Art = FACES[card];
  return Art ? <Art /> : null;
}
