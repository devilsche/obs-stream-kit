"""Server-Sent Events Hub.

Statt dass das Widget/Tool alle 200ms /state pollt, halten Clients eine
EventSource-Verbindung offen. Wenn der State sich aendert (Channel
move, talk-status, mate join/leave), pusht der Hub den neuen Snapshot
an ALLE verbundenen Clients.

Implementation: simple Queue-based broadcast. Pro Subscriber eine
queue.Queue, publish() schiebt in alle Queues. HTTP-Handler liest aus
seiner Queue und schreibt in die SSE-Antwort.
"""

import json
import queue
import threading
import time


class SSEHub:
    def __init__(self):
        self._subs = []          # list of queue.Queue
        self._lock = threading.Lock()
        self._last_snapshot = None  # fuer initial send

    def subscribe(self):
        """Returns eine Queue. Caller liest in einer Loop davon."""
        q = queue.Queue(maxsize=50)
        with self._lock:
            self._subs.append(q)
            # initiales Snapshot in die Queue
            if self._last_snapshot is not None:
                try:
                    q.put_nowait(self._last_snapshot)
                except queue.Full:
                    pass
        return q

    def unsubscribe(self, q):
        with self._lock:
            try:
                self._subs.remove(q)
            except ValueError:
                pass

    def publish(self, snapshot):
        """snapshot ist ein dict — wird zu JSON serialisiert."""
        msg = json.dumps(snapshot)
        with self._lock:
            self._last_snapshot = msg
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(msg)
            except queue.Full:
                # Slow consumer — wir droppen den aeltesten Event
                try:
                    q.get_nowait()
                    q.put_nowait(msg)
                except (queue.Empty, queue.Full):
                    pass

    def subscriber_count(self):
        with self._lock:
            return len(self._subs)
