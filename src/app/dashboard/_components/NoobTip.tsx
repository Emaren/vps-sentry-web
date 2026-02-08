import React from "react";

export default function NoobTip(props: { text: string; children?: React.ReactNode }) {
  const { text, children } = props;
  if (!children) return null;

  return (
    <span
      className="dashboard-help-target"
      title={text}
      aria-label={text}
      role="note"
      tabIndex={0}
    >
      {children}
    </span>
  );
}
