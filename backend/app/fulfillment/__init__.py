"""FBS product, inventory and fulfilment domain."""

from .repository import InMemoryFulfillmentRepository
from .service import FulfillmentService

__all__ = ["FulfillmentService", "InMemoryFulfillmentRepository"]
