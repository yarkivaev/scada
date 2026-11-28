/** Encode a single value as a literal argument for a POSIX shell. */
export default function shellArgument(value) {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
