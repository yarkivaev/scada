function timestamps(parsed) {
    const startTime = new Date(parsed.start);
    const endTime = new Date(parsed.end);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        throw new Error('Invalid segment timestamp');
    }
    return { startTime, endTime };
}

function mapTags(parsed) {
    if (parsed.tags === undefined || parsed.tags === null) {
        return undefined;
    }
    return typeof parsed.tags === 'string' ? parsed.tags : JSON.stringify(parsed.tags);
}

function mapProperties(parsed) {
    if (parsed.properties === undefined) {
        return undefined;
    }
    return typeof parsed.properties === 'string' ? parsed.properties : JSON.stringify(parsed.properties);
}

function segmentRow(parsed, startTime, endTime) {
    const row = {
        name: parsed.name,
        start_time: startTime,
        end_time: endTime,
        duration: parsed.duration
    };
    if (parsed.options !== undefined) {
        row.options = parsed.options;
    }
    const tags = mapTags(parsed);
    if (tags !== undefined) {
        row.tags = tags;
    }
    const properties = mapProperties(parsed);
    if (properties !== undefined) {
        row.properties = properties;
    }
    return row;
}

function emitPiece(bus, piece) {
    const times = timestamps(piece);
    bus.emit({ type: 'created', segment: segmentRow(piece, times.startTime, times.endTime) });
}

function consume(raw, buses) {
    const parsed = JSON.parse(raw.payload);
    const bus = buses[parsed.machine];
    if (!bus) {
        return;
    }
    if (parsed.type === 'split-family' && Array.isArray(parsed.pieces)) {
        parsed.pieces.forEach((piece) => {
            emitPiece(bus, piece);
        });
        return;
    }
    emitPiece(bus, parsed);
}

/**
 * STOMP-to-timeline-bus bridge for segment messages.
 *
 * Subscribes to STOMP segment exchange and emits created events
 * on per-machine timeline pubsub buses for SSE delivery.
 * A split-family envelope emits one event per piece. The envelope
 * itself has no start or end, and must not be read as one segment.
 *
 * @param {function} source - factory(collector) returning { start(), stop() }
 * @param {object} buses - map of machine IDs to pubsub buses with emit()
 * @returns {object} bridge with stop() method
 *
 * @example
 *   const bridge = stompTimelineSegments(sourceFactory, { m1: bus });
 *   bridge.stop();
 */
export default function stompTimelineSegments(source, buses) {
    const subscription = source({
        accept(raw) {
            consume(raw, buses);
        }
    });
    return {
        stop() {
            subscription.stop();
        }
    };
}
