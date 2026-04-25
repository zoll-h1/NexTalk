from fastapi import HTTPException, status


def unauthorized_exception(message: str = "Unauthorized") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)


def forbidden_exception(message: str = "Forbidden") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message)


def not_found_exception(message: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def bad_request_exception(message: str = "Bad request") -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
