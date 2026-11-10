/** A former SAC delivery cannot allocate or publish a newer admission. */
export default function nativeMetricsOwnership({ active } = {}) {
    if (active !== undefined && (typeof active !== 'function' || active() !== true)) {
        const error = new Error('Central admission ownership lost');
        error.code = 'SCADA_ADMISSION_OWNERSHIP_LOST';
        throw error;
    }
}
