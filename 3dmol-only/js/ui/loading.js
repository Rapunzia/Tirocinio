import { appState } from '../state.js';

// Shows or hides the global loading overlay and resets progress state.
export function setLoading(isVisible, message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingMsg').textContent = message;
    overlay.classList.toggle('active', isVisible);

    if (isVisible) {
        document.getElementById('progressBar').style.width = '0%';
        simulateProgress();
    }
}

// Simulates progress while async viewers perform setup.
function simulateProgress() {
    clearInterval(appState.progressTimer);

    let progress = 0;
    const bar = document.getElementById('progressBar');

    appState.progressTimer = setInterval(() => {
        progress += Math.random() * 12;
        if (progress >= 90) {
            clearInterval(appState.progressTimer);
            progress = 90;
        }
        bar.style.width = `${progress}%`;
    }, 200);
}

// Completes and hides the loading overlay.
export function finishProgress() {
    clearInterval(appState.progressTimer);
    document.getElementById('progressBar').style.width = '100%';
    setTimeout(() => setLoading(false), 300);
}
