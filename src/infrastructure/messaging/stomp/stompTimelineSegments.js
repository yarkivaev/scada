function timestamps(parsed) {
    const startTime = new Date(parsed.start);
    const endTime = new Date(parsed.end);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        throw new Error('Invalid segment timestamp');
    }
    return { startTime, endTime };
}

function mapTags(parsed) {
    if (parsed.tags === undefined) {
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

function consume(raw, buses) {
    const parsed = JSON.parse(raw.payload);
    const bus = buses[parsed.machine];
    if (!bus) {
        return;
    }
    const { startTime, endTime } = timestamps(parsed);
    bus.emit({ type: 'created', segment: segmentRow(parsed, startTime, endTime) });
}

/**
 * STOMP-to-timeline-bus bridge for segment messages.
 *
 * Subscribes to STOMP segment exchange and emits created events
 * on per-machine timeline pubsub buses for SSE delivery.
 *
 * @param {function} source - factory(collector) returning { start(), stop() }
 * @param {object} buses - map of machine IDs to pubsub buses with emit()
 * @returns {object} bridge with stop() method
 *
 * @example
 *   const bridge = stompTimelineSegments(sourceFactory, { icht1: bus });
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
