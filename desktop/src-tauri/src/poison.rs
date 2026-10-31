//! A mutex whose holder panicked is poisoned, and `lock().unwrap()` then panics
//! in every other thread that takes it: the tray and its watcher went down with
//! no record (ticket 86, pit-wall thread 136 #8613). The data behind it is still
//! there, and the tray's locks guard plain state (the account, the supervisor),
//! so the guard is taken anyway and the panic hook (launch_log) has recorded why.
use std::sync::{Mutex, MutexGuard, PoisonError};

/// The mutex's guard, poisoned or not.
pub fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn the_guard_of_a_poisoned_mutex_is_still_taken() {
        let m = Arc::new(Mutex::new(1));
        let held = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _guard = held.lock().unwrap();
            panic!("the holder dies with the lock");
        })
        .join();
        assert!(m.lock().is_err(), "the mutex is poisoned");
        assert_eq!(*locked(&m), 1);
        *locked(&m) = 2;
        assert_eq!(*locked(&m), 2);
    }

    #[test]
    fn an_ordinary_mutex_locks_as_before() {
        let m = Mutex::new(String::from("a"));
        locked(&m).push('b');
        assert_eq!(*locked(&m), "ab");
    }
}
