/** @jsxImportSource @opentui/react */

import { useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import qrcode from "qrcode-terminal";
import { THEME } from "../lib/theme.js";

interface QrOverlayProps {
  qr: string;
  onClose: () => void;
}

/**
 * Centered overlay that renders a WhatsApp pairing QR inline.
 *
 * Uses qrcode-terminal's CALLBACK form to get the ASCII string — the default
 * form prints straight to stdout, which would corrupt the opentui screen.
 */
export function QrOverlay({ qr, onClose }: QrOverlayProps) {
  const renderer = useRenderer();
  const [ascii, setAscii] = useState("");

  useEffect(() => {
    qrcode.generate(qr, { small: true }, (str: string) => setAscii(str));
  }, [qr]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || key.name === "enter") onClose();
  });

  const lines = ascii ? ascii.split("\n").length : 0;
  const width = Math.min(64, Math.max(44, Math.floor(renderer.width * 0.6)));
  // Headroom for title + subtitle + 2 spacers + footer + border/padding.
  const height = Math.min(renderer.height - 2, lines + 9);
  const left = Math.max(0, Math.floor((renderer.width - width) / 2));
  const top = Math.max(0, Math.floor((renderer.height - height) / 2));

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      flexDirection="column"
      border
      borderColor={THEME.dim}
      backgroundColor="black"
      shouldFill
      padding={1}
      zIndex={100}
    >
      <text content="Escaneie pra conectar o WhatsApp" fg={THEME.text} bg="black" />
      <text content="WhatsApp › Aparelhos conectados" fg={THEME.faint} bg="black" />
      <box height={1} />
      <text content={ascii || "gerando QR…"} fg="white" bg="black" />
      <box height={1} />
      <text content="Esc / Enter fecha" fg={THEME.faint} bg="black" />
    </box>
  );
}
