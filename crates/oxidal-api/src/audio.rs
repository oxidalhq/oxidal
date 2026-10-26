//! Device inspection stays on a blocking worker and never changes the playing rig.
use super::*;
use oxidal_audio::{AudioDevices, AudioProbe, AudioProbeResult};

// Share one permit across routers: a dropped HTTP request must not free it while ALSA is still running.
static PROBE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

pub async fn devices() -> Response {
    let Ok(permit) = PROBE.try_acquire() else {
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
