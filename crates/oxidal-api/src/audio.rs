//! Device inspection stays on a blocking worker and never changes the playing rig.
use super::*;
use oxidal_audio::{AudioDevices, AudioProbe, AudioProbeResult};

// Share one permit across routers: a dropped HTTP request must not free it while ALSA is still running.
pub(super) static PROBE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

// Enumeration uses control handles only, never PCM streams. Keep it available
// during playback while bounding concurrent blocking driver inspection.
static DISCOVERY: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

pub async fn devices() -> Response {
    let Ok(permit) = DISCOVERY.try_acquire() else {
        return failure(StatusCode::CONFLICT, "Audio inspection already in progress");
    };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        oxidal_audio::devices()
    })
    .await
    {
        Ok(Ok(value)) => Json::<AudioDevices>(value).into_response(),
        Ok(Err(error)) => failure(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(_) => failure(StatusCode::SERVICE_UNAVAILABLE, "Audio discovery failed"),
    }
}

pub async fn probe(payload: Result<Json<AudioProbe>, JsonRejection>) -> Response {
    let Ok(Json(request)) = payload else {
        return failure(StatusCode::BAD_REQUEST, "invalid_audio_probe");
    };
    if let Err(error) = request.validate() {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, &error);
    }
    let Ok(permit) = PROBE.try_acquire() else {
        return failure(StatusCode::CONFLICT, "Audio inspection already in progress");
    };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        oxidal_audio::probe(&request)
    })
    .await
    {
        Ok(Ok(value)) => Json::<AudioProbeResult>(value).into_response(),
        Ok(Err(error)) => failure(StatusCode::UNPROCESSABLE_ENTITY, &error),
        Err(_) => failure(StatusCode::SERVICE_UNAVAILABLE, "Audio probe failed"),
    }
}

/// Hardware MIDI discovery is separate from audio probe/PCM ownership.
pub async fn midi_devices() -> Response {
    let Ok(permit) = DISCOVERY.try_acquire() else {
        return failure(
            StatusCode::CONFLICT,
            "Device inspection already in progress",
        );
    };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        oxidal_audio::midi::devices()
    })
    .await
    {
        Ok(Ok(devices)) => Json(devices).into_response(),
        Ok(Err(error)) => failure(StatusCode::SERVICE_UNAVAILABLE, &error),
        Err(_) => failure(StatusCode::SERVICE_UNAVAILABLE, "MIDI discovery failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn discovery_is_available_while_pcm_owns_the_audio_permit() {
        let _audio_owner = PROBE.acquire().await.unwrap();
        let reply = midi_devices().await;
        assert_eq!(reply.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(reply.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let _: oxidal_audio::midi::Devices = serde_json::from_slice(&bytes).unwrap();
        let reply = devices().await;
        assert_eq!(reply.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(reply.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let _: AudioDevices = serde_json::from_slice(&bytes).unwrap();
    }
}
