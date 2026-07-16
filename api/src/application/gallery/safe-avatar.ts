export type SafeAvatarImage = Readonly<{
  contentType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}>;

export function inspectSafeAvatar(bytes: Uint8Array, declaredType: string): SafeAvatarImage {
  const image = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  if (!image || image.contentType !== declaredType || image.width > 4096 || image.height > 4096)
    throw new Error("invalid_gallery_avatar");
  return image;
}

function png(bytes: Uint8Array): SafeAvatarImage | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  return {contentType: "image/png", width: u32(bytes, 16), height: u32(bytes, 20)};
}

function jpeg(bytes: Uint8Array): SafeAvatarImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
      return {contentType: "image/jpeg", height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!};
    offset += length + 2;
  }
  return null;
}

function webp(bytes: Uint8Array): SafeAvatarImage | null {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return null;
  if (text(12, 4) === "VP8X") return {contentType: "image/webp", width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1};
  return null;
}

const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
const u24 = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
