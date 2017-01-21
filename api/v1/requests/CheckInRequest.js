var Request = require('./Request');

var bodyRequired = ['checkedIn', 'travel', 'location', 'swag'];
var bodyValidations = {
    checkedIn: ['required', 'boolean'],
    travel: ['required'],
    location: ['required'],
    swag: ['required', 'boolean']
};


function CheckInRequest(headers, body) {
    Request.call(this, headers, body);

    this.bodyRequired = bodyRequired;
    this.bodyAllowed = bodyAllowed;
    this.bodyValidations = bodyValidations;
};


CheckInRequest.prototype = Object.create(Request.prototype);
CheckInRequest.prototype.constructor = CheckInRequest;

module.exports = CheckInRequest;