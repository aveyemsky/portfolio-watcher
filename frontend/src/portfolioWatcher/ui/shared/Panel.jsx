import { forwardRef } from "react";

const Panel = forwardRef(function Panel({ children, className = "", style }, ref) {
  return (
    <section ref={ref} className={`pw-panel ${className}`} style={style}>
      {children}
    </section>
  );
});

export default Panel;
