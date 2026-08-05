from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class Empty(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class InvokeRequest(_message.Message):
    __slots__ = ("parent_fsm_name", "parent_fsm_version", "fsm_type", "fsm_name", "fsm_version", "fsm_language", "input_json", "instance_id", "correlation_id", "timeout_ms")
    PARENT_FSM_NAME_FIELD_NUMBER: _ClassVar[int]
    PARENT_FSM_VERSION_FIELD_NUMBER: _ClassVar[int]
    FSM_TYPE_FIELD_NUMBER: _ClassVar[int]
    FSM_NAME_FIELD_NUMBER: _ClassVar[int]
    FSM_VERSION_FIELD_NUMBER: _ClassVar[int]
    FSM_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    INPUT_JSON_FIELD_NUMBER: _ClassVar[int]
    INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    CORRELATION_ID_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_MS_FIELD_NUMBER: _ClassVar[int]
    parent_fsm_name: str
    parent_fsm_version: str
    fsm_type: str
    fsm_name: str
    fsm_version: str
    fsm_language: str
    input_json: str
    instance_id: str
    correlation_id: str
    timeout_ms: int
    def __init__(self, parent_fsm_name: _Optional[str] = ..., parent_fsm_version: _Optional[str] = ..., fsm_type: _Optional[str] = ..., fsm_name: _Optional[str] = ..., fsm_version: _Optional[str] = ..., fsm_language: _Optional[str] = ..., input_json: _Optional[str] = ..., instance_id: _Optional[str] = ..., correlation_id: _Optional[str] = ..., timeout_ms: _Optional[int] = ...) -> None: ...

class InvokeResponse(_message.Message):
    __slots__ = ("ok", "output_json", "error_code", "error_message", "retriable")
    OK_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_JSON_FIELD_NUMBER: _ClassVar[int]
    ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    RETRIABLE_FIELD_NUMBER: _ClassVar[int]
    ok: bool
    output_json: str
    error_code: str
    error_message: str
    retriable: bool
    def __init__(self, ok: _Optional[bool] = ..., output_json: _Optional[str] = ..., error_code: _Optional[str] = ..., error_message: _Optional[str] = ..., retriable: _Optional[bool] = ...) -> None: ...

class ListRegisteredActorsResponse(_message.Message):
    __slots__ = ("actor_keys",)
    ACTOR_KEYS_FIELD_NUMBER: _ClassVar[int]
    actor_keys: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, actor_keys: _Optional[_Iterable[str]] = ...) -> None: ...
