// Small line icons, drawn on a 16 px grid in the current text colour.

function Svg(props: { children: preact.ComponentChildren; label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props.label ? undefined : true}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      {props.children}
    </svg>
  );
}

export const GearIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </Svg>
);

export const BackIcon = () => (
  <Svg>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
);

export const ChevronIcon = () => (
  <Svg>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.3 3.3" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const LayersIcon = () => (
  <Svg>
    <path d="M8 2.5 14 5.5 8 8.5 2 5.5z" />
    <path d="m2 8.5 6 3 6-3" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M8 5.5v5M5.5 8h5" />
  </Svg>
);
