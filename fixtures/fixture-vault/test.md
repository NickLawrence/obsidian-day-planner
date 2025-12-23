
# Heading 1

- List item
  ```activities
  key: value
  ```
  - [ ] Nested task with 1 log record
    ```activities
    activities:
      - activity: Nested task with 1 log record
        log:
          - start: 2025-07-18 12:00
            end: 2025-07-18 14:40
    ```

## Heading 2

- [ ] Task with 3 log records
  ```activities
  activities:
    - activity: Task with 3 log records
      log:
        - start: 2025-07-19 12:00
          end: 2025-07-19 14:30
        - start: 2025-07-19 15:00
          end: 2025-07-19 16:30
        - start: 2025-07-19 13:00
          end: 2025-07-19 16:30
  ```
