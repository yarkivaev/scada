/** Preserve identifiers in JSON and make nonprinting characters visible in terminal reports. */
export default function terminalLabel(value) {
    return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
        return `\\u{${character.codePointAt(0).toString(16)}}`;
    });
}
