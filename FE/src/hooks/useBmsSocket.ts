"use client";
// Koneksi WS kini dikelola satu tempat (WsProvider) supaya ada status global + tidak
// membuka koneksi berkali-kali. Hook ini tetap ada demi kompatibilitas import lama.
export { useBmsSocket } from "@/context/WsContext";
