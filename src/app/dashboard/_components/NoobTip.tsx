import React from "react";

export default function NoobTip(props: { text: string }) {
  const { text } = props;
  return (
    <span
      className="dashboard-noob-tip"
      title={text}
      aria-label={text}
      role="note"
      tabIndex={0}
    >
      ?
    </span>
  );
}
