// Displays short status messages at the bottom of the page.
export function showToast(message, isError = false, durationMs = 3000) {
    let toast = document.getElementById('_toast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `toast${isError ? ' error' : ''}`;

    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    clearTimeout(toast._timeoutId);
    if (durationMs === null) {
        toast._timeoutId = null;
        return;
    }

    toast._timeoutId = setTimeout(() => {
        toast.classList.remove('visible');
    }, durationMs);
}

export function hideToast() {
    const toast = document.getElementById('_toast');
    if (!toast) return;

    clearTimeout(toast._timeoutId);
    toast._timeoutId = null;
    toast.classList.remove('visible');
}
